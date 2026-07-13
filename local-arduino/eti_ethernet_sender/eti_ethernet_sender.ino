#include <SPI.h>
#include <Ethernet.h>
#include <EthernetUdp.h>
#include <Wire.h>
#include <avr/pgmspace.h>

// =====================
// ETI Arduino Ethernet footage sender
// =====================
// Sends plain HTTP to the Django project relay. The project forwards to the
// Firebase nodes the live footage app already reads:
//   /ETI_CURRENT_SPEED.json -> {"currentSpeed":123,"timestamp":...}
//   /ETI_SPEED.json         -> {"footage":12.3,"timestamp":...}
//
// Hardware note:
// Pin 13 is SPI SCK on Arduino Ethernet hardware. Ethernet uses that pin for
// network traffic, so it cannot be used as a reliable sensor input.
// Move the ETI sensor wire to D2.

// =====================
// Network
// =====================
byte MAC_ADDRESS[] = { 0xDE, 0xAD, 0xBE, 0xEF, 0x13, 0x01 };

// Backend computer running this Django project. Change this if the server IP is
// different on your plant network.
const char* PROJECT_HOST = "192.168.1.174";
IPAddress PROJECT_IP(192, 168, 1, 174);
const int PROJECT_PORT = 8000;

const bool USE_LOCAL_DATABASE_ONLY = true;
const char* SPEED_PATH = USE_LOCAL_DATABASE_ONLY ? "/api/local-live-footage/eti/speed/" : "/api/live-footage-relay/eti/speed/";
const char* DAILY_PATH = USE_LOCAL_DATABASE_ONLY ? "/api/local-live-footage/eti/daily/" : "/api/live-footage-relay/eti/daily/";
const char* DEVICE_TOKEN = ""; // Optional: match Django LIVE_FOOTAGE_DEVICE_TOKEN.

EthernetClient client;
EthernetUDP udp;

// =====================
// OLED display
// =====================
const bool USE_OLED_DISPLAY = true;
const byte OLED_PRIMARY_ADDRESS = 0x3C;
const byte OLED_SECONDARY_ADDRESS = 0x3D;
const byte OLED_WIDTH = 128;
const byte OLED_PAGES = 8;
const byte OLED_DIGIT_TOP_PAGE = 1;
const byte OLED_DIGIT_BLOCK_WIDTH = 8;
const byte OLED_DIGIT_BLOCK_GAP = 1;
const byte OLED_DIGIT_SPACING = 4;
const byte OLED_DIGIT_WIDTH = (OLED_DIGIT_BLOCK_WIDTH * 3) + (OLED_DIGIT_BLOCK_GAP * 2);

byte oledAddress = OLED_PRIMARY_ADDRESS;
bool oledReady = false;
int lastOledSpeed = -1;

const byte OLED_DIGITS[10][5] PROGMEM = {
  {0b111, 0b101, 0b101, 0b101, 0b111},
  {0b010, 0b110, 0b010, 0b010, 0b111},
  {0b111, 0b001, 0b111, 0b100, 0b111},
  {0b111, 0b001, 0b111, 0b001, 0b111},
  {0b101, 0b101, 0b111, 0b001, 0b001},
  {0b111, 0b100, 0b111, 0b001, 0b111},
  {0b111, 0b100, 0b111, 0b101, 0b111},
  {0b111, 0b001, 0b001, 0b001, 0b001},
  {0b111, 0b101, 0b111, 0b101, 0b111},
  {0b111, 0b101, 0b111, 0b001, 0b111},
};

const byte OLED_LABEL_FPM[] PROGMEM = {
  0x7F, 0x09, 0x09, 0x09, 0x01, 0x00,
  0x7F, 0x09, 0x09, 0x09, 0x06, 0x00,
  0x7F, 0x02, 0x04, 0x02, 0x7F
};

// =====================
// Sensor / measurement
// =====================
const byte SENSOR_PIN = 2;
const int SENSOR_ACTIVE_LEVEL = LOW;
const int SENSOR_INTERRUPT_MODE = SENSOR_ACTIVE_LEVEL == LOW ? FALLING : RISING;

const float wheelDiameterInches = 3.0f;
const unsigned int pulsesPerRev = 1;
const float inchesPerPulse = (PI * wheelDiameterInches) / pulsesPerRev;

const unsigned long debounceUs = 20000UL;
const float maxValidSpeedFpm = 700.0f;

volatile unsigned long lastPulseUs = 0;
volatile unsigned long pulsesSpeed = 0;
volatile unsigned long pulsesDaily = 0;
volatile unsigned long pulsesDiag = 0;
volatile unsigned long rejectedDebounce = 0;

// =====================
// Intervals
// =====================
const bool TEST_FAST_SEND_MODE = false;
const bool LOCAL_FAST_SEND_MODE = USE_LOCAL_DATABASE_ONLY || TEST_FAST_SEND_MODE;
const unsigned long SPEED_INTERVAL_MS = LOCAL_FAST_SEND_MODE ? 2UL * 1000UL : 30UL * 1000UL;
const unsigned long DAILY_INTERVAL_MS = LOCAL_FAST_SEND_MODE ? 15UL * 1000UL : 7UL * 60UL * 1000UL;
const unsigned long DIAG_INTERVAL_MS = 1000UL;
const unsigned long NTP_RESYNC_MS = 6UL * 60UL * 60UL * 1000UL;

unsigned long lastSpeedTime = 0;
unsigned long lastDailyTime = 0;
unsigned long lastDiagTime = 0;
unsigned long diagLastTotal = 0;

// =====================
// Time / NTP
// =====================
// Fixed NTP IP keeps this compatible with Arduino Ethernet libraries that do
// not expose Ethernet.hostByName().
IPAddress NTP_SERVER_IP(129, 6, 15, 28); // time.nist.gov
const unsigned int LOCAL_NTP_PORT = 8888;
const unsigned long NTP_TIMEOUT_MS = 1500UL;
const int NTP_PACKET_SIZE = 48;
byte ntpPacketBuffer[NTP_PACKET_SIZE];

unsigned long epochAtSync = 0;
unsigned long millisAtSync = 0;
unsigned long lastNtpAttempt = 0;

unsigned long nowEpoch() {
  if (epochAtSync == 0) return 0;
  return epochAtSync + ((millis() - millisAtSync) / 1000UL);
}

int roundFloatToInt(float value) {
  return value >= 0.0f ? (int)(value + 0.5f) : (int)(value - 0.5f);
}

unsigned long ceilFloatToUL(float value) {
  if (value <= 0.0f) return 0;
  unsigned long whole = (unsigned long)value;
  return value > (float)whole ? whole + 1 : whole;
}

// =====================
// OLED helpers
// =====================
bool i2cDeviceFound(byte address) {
  Wire.beginTransmission(address);
  return Wire.endTransmission() == 0;
}

void oledCommand(byte command) {
  if (!oledReady) return;
  Wire.beginTransmission(oledAddress);
  Wire.write(0x00);
  Wire.write(command);
  Wire.endTransmission();
}

void oledCommandList(const byte* commands, byte count) {
  if (!oledReady) return;
  Wire.beginTransmission(oledAddress);
  Wire.write(0x00);
  for (byte i = 0; i < count; i++) {
    Wire.write(commands[i]);
  }
  Wire.endTransmission();
}

void oledSetCursor(byte page, byte column) {
  oledCommand(0xB0 | (page & 0x07));
  oledCommand(0x00 | (column & 0x0F));
  oledCommand(0x10 | ((column >> 4) & 0x0F));
}

void oledFill(byte page, byte column, byte width, byte value) {
  if (!oledReady || page >= OLED_PAGES || column >= OLED_WIDTH) return;
  if ((int)column + width > OLED_WIDTH) {
    width = OLED_WIDTH - column;
  }

  oledSetCursor(page, column);
  while (width > 0) {
    byte chunk = width > 16 ? 16 : width;
    Wire.beginTransmission(oledAddress);
    Wire.write(0x40);
    for (byte i = 0; i < chunk; i++) {
      Wire.write(value);
    }
    Wire.endTransmission();
    width -= chunk;
  }
}

void oledClear() {
  if (!oledReady) return;
  for (byte page = 0; page < OLED_PAGES; page++) {
    oledFill(page, 0, OLED_WIDTH, 0x00);
  }
}

void oledWriteProgmemBytes(byte page, byte column, const byte* bytes, byte count) {
  if (!oledReady || page >= OLED_PAGES || column >= OLED_WIDTH) return;
  oledSetCursor(page, column);
  while (count > 0) {
    byte chunk = count > 16 ? 16 : count;
    Wire.beginTransmission(oledAddress);
    Wire.write(0x40);
    for (byte i = 0; i < chunk; i++) {
      Wire.write(pgm_read_byte(bytes + i));
    }
    Wire.endTransmission();
    bytes += chunk;
    count -= chunk;
  }
}

void oledDrawDigit(char digit, byte x, byte topPage) {
  if (digit < '0' || digit > '9') return;
  byte digitIndex = digit - '0';

  for (byte row = 0; row < 5; row++) {
    byte pattern = pgm_read_byte(&OLED_DIGITS[digitIndex][row]);
    for (byte block = 0; block < 3; block++) {
      if (pattern & (1 << (2 - block))) {
        byte column = x + block * (OLED_DIGIT_BLOCK_WIDTH + OLED_DIGIT_BLOCK_GAP);
        oledFill(topPage + row, column, OLED_DIGIT_BLOCK_WIDTH, 0xFF);
      }
    }
  }
}

void oledDrawFpmLabel() {
  byte labelWidth = sizeof(OLED_LABEL_FPM);
  byte startColumn = (OLED_WIDTH - labelWidth) / 2;
  oledWriteProgmemBytes(7, startColumn, OLED_LABEL_FPM, labelWidth);
}

void updateOledSpeed(int speedFpm) {
  if (!oledReady) return;
  if (speedFpm < 0) speedFpm = 0;
  if (speedFpm > 999) speedFpm = 999;
  if (speedFpm == lastOledSpeed) return;
  lastOledSpeed = speedFpm;

  char value[4];
  itoa(speedFpm, value, 10);
  byte digitCount = strlen(value);
  byte numberWidth = (digitCount * OLED_DIGIT_WIDTH) + ((digitCount - 1) * OLED_DIGIT_SPACING);
  byte startColumn = (OLED_WIDTH - numberWidth) / 2;

  oledClear();
  for (byte i = 0; i < digitCount; i++) {
    byte x = startColumn + i * (OLED_DIGIT_WIDTH + OLED_DIGIT_SPACING);
    oledDrawDigit(value[i], x, OLED_DIGIT_TOP_PAGE);
  }
  oledDrawFpmLabel();
}

void setupOledDisplay() {
  if (!USE_OLED_DISPLAY) return;

  Wire.begin();
  Wire.setClock(100000L);

  if (i2cDeviceFound(OLED_PRIMARY_ADDRESS)) {
    oledAddress = OLED_PRIMARY_ADDRESS;
  } else if (i2cDeviceFound(OLED_SECONDARY_ADDRESS)) {
    oledAddress = OLED_SECONDARY_ADDRESS;
  } else {
    Serial.println("OLED not found at I2C address 0x3C or 0x3D.");
    return;
  }

  oledReady = true;
  const byte initCommands[] = {
    0xAE, 0xD5, 0x80, 0xA8, 0x3F, 0xD3, 0x00, 0x40,
    0x8D, 0x14, 0x20, 0x02, 0xA1, 0xC8, 0xDA, 0x12,
    0x81, 0xCF, 0xD9, 0xF1, 0xDB, 0x40, 0xA4, 0xA6,
    0xAF
  };
  oledCommandList(initCommands, sizeof(initCommands));
  oledClear();
  updateOledSpeed(0);

  Serial.print("OLED display ready at 0x");
  Serial.println(oledAddress, HEX);
}

bool syncTimeNtp() {
  memset(ntpPacketBuffer, 0, NTP_PACKET_SIZE);
  ntpPacketBuffer[0] = 0b11100011;
  ntpPacketBuffer[1] = 0;
  ntpPacketBuffer[2] = 6;
  ntpPacketBuffer[3] = 0xEC;
  ntpPacketBuffer[12] = 49;
  ntpPacketBuffer[13] = 0x4E;
  ntpPacketBuffer[14] = 49;
  ntpPacketBuffer[15] = 52;

  udp.beginPacket(NTP_SERVER_IP, 123);
  udp.write(ntpPacketBuffer, NTP_PACKET_SIZE);
  udp.endPacket();

  unsigned long started = millis();
  while (millis() - started < NTP_TIMEOUT_MS) {
    int size = udp.parsePacket();
    if (size >= NTP_PACKET_SIZE) {
      udp.read(ntpPacketBuffer, NTP_PACKET_SIZE);
      unsigned long highWord = word(ntpPacketBuffer[40], ntpPacketBuffer[41]);
      unsigned long lowWord = word(ntpPacketBuffer[42], ntpPacketBuffer[43]);
      unsigned long secsSince1900 = (highWord << 16) | lowWord;
      epochAtSync = secsSince1900 - 2208988800UL;
      millisAtSync = millis();
      Serial.print("NTP synced epoch=");
      Serial.println(epochAtSync);
      return true;
    }
  }

  Serial.println("NTP timeout.");
  return false;
}

// =====================
// Pulse logic
// =====================
void countPulse() {
  unsigned long nowUs = micros();

  if (nowUs - lastPulseUs <= debounceUs) {
    rejectedDebounce++;
    return;
  }

  pulsesSpeed++;
  pulsesDaily++;
  pulsesDiag++;
  lastPulseUs = nowUs;
}

// =====================
// HTTP helpers
// =====================
bool sendHttpRequest(const char* method, const char* path, const char* payload) {
  Serial.print("HTTP sending ");
  Serial.print(method);
  Serial.print(" ");
  Serial.print(path);
  Serial.print(" -> ");
  Serial.print(PROJECT_IP);
  Serial.print(":");
  Serial.println(PROJECT_PORT);

  if (!client.connect(PROJECT_IP, PROJECT_PORT)) {
    Serial.print("HTTP connect failed to ");
    Serial.print(PROJECT_IP);
    Serial.print(":");
    Serial.print(PROJECT_PORT);
    Serial.print(" ");
    Serial.println(path);
    return false;
  }

  client.print(method);
  client.print(" ");
  client.print(path);
  client.println(" HTTP/1.1");
  client.print("Host: ");
  client.println(PROJECT_HOST);
  client.println("User-Agent: TSM-ETI-Arduino-Ethernet");
  client.println("Connection: close");
  client.println("Content-Type: application/json");
  if (strlen(DEVICE_TOKEN) > 0) {
    client.print("X-Device-Token: ");
    client.println(DEVICE_TOKEN);
  }
  client.print("Content-Length: ");
  client.println(strlen(payload));
  client.println();
  client.print(payload);

  unsigned long started = millis();
  while (client.connected() && !client.available() && millis() - started < 4000UL) {
    delay(1);
  }

  int statusCode = 0;
  if (client.available()) {
    String statusLine = client.readStringUntil('\n');
    statusLine.trim();
    statusCode = statusLine.substring(9, 12).toInt();
  }

  while (client.available()) client.read();
  client.stop();

  Serial.print(method);
  Serial.print(" ");
  Serial.print(path);
  Serial.print(" HTTP ");
  Serial.println(statusCode);

  if (statusCode >= 400) {
    Serial.println("Relay rejected the payload. Check Django console/logs.");
  }

  return statusCode >= 200 && statusCode < 300;
}

unsigned long maxPulsesForInterval(unsigned long intervalMs) {
  float maxFeet = maxValidSpeedFpm * (intervalMs / 60000.0f);
  float maxPulses = (maxFeet * 12.0f) / inchesPerPulse;
  return ceilFloatToUL(maxPulses) + 2;
}

void publishSpeed(unsigned long elapsedMs) {
  noInterrupts();
  unsigned long cnt = pulsesSpeed;
  pulsesSpeed = 0;
  interrupts();

  if (cnt > maxPulsesForInterval(elapsedMs)) {
    Serial.print("Ignoring impossible speed pulse count: ");
    Serial.println(cnt);
    cnt = 0;
  }

  float distanceFeet = (cnt * inchesPerPulse) / 12.0f;
  float speedFpm = elapsedMs > 0 ? (distanceFeet / (elapsedMs / 1000.0f)) * 60.0f : 0.0f;
  int speedInt = roundFloatToInt(speedFpm);

  char payload[96];
  snprintf(payload, sizeof(payload),
           "{\"currentSpeed\":%d,\"timestamp\":%lu}",
           speedInt, nowEpoch());

  Serial.print("[SPEED] pulses=");
  Serial.print(cnt);
  Serial.print(" fpm=");
  Serial.println(speedInt);

  sendHttpRequest("PUT", SPEED_PATH, payload);
}

void publishDaily(unsigned long elapsedMs) {
  noInterrupts();
  unsigned long cnt = pulsesDaily;
  pulsesDaily = 0;
  interrupts();

  float footage = (cnt * inchesPerPulse) / 12.0f;
  unsigned long safeElapsedMs = max(elapsedMs, 60000UL);
  float maxDailyFootage = maxValidSpeedFpm * (safeElapsedMs / 60000.0f) + 5.0f;

  if (footage < 0.0f || footage > maxDailyFootage) {
    Serial.print("[DAILY] Footage out of range; skipping ");
    Serial.println(footage);
    return;
  }

  float footageRounded = round(footage * 10.0f) / 10.0f;
  char payload[96];
  snprintf(payload, sizeof(payload),
           "{\"footage\":%.1f,\"timestamp\":%lu}",
           footageRounded, nowEpoch());

  Serial.print("[DAILY] pulses=");
  Serial.print(cnt);
  Serial.print(" footage=");
  Serial.println(footageRounded);

  sendHttpRequest("POST", DAILY_PATH, payload);
}

void printDiagnostics() {
  unsigned long nowMs = millis();
  if (nowMs - lastDiagTime < DIAG_INTERVAL_MS) return;
  unsigned long dtMs = lastDiagTime == 0 ? DIAG_INTERVAL_MS : nowMs - lastDiagTime;
  lastDiagTime = nowMs;

  noInterrupts();
  unsigned long total = pulsesDiag;
  unsigned long rejectedDb = rejectedDebounce;
  interrupts();

  unsigned long dPulses = total - diagLastTotal;
  diagLastTotal = total;

  float pulsesPerSec = dtMs > 0 ? dPulses * 1000.0f / dtMs : 0.0f;
  float feetPerMin = ((pulsesPerSec * inchesPerPulse) / 12.0f) * 60.0f;
  int displaySpeed = roundFloatToInt(feetPerMin);
  updateOledSpeed(displaySpeed);

  Serial.print("[DIAG] total=");
  Serial.print(total);
  Serial.print(" +");
  Serial.print(dPulses);
  Serial.print(" est=");
  Serial.print(displaySpeed);
  Serial.print(" fpm pin=");
  Serial.print(digitalRead(SENSOR_PIN));
  Serial.print(" rejectDb=");
  Serial.println(rejectedDb);
}

void handleSerialCommands() {
  if (!Serial.available()) return;
  char c = Serial.read();
  if (c == 'r') {
    noInterrupts();
    pulsesDiag = 0;
    pulsesSpeed = 0;
    pulsesDaily = 0;
    rejectedDebounce = 0;
    interrupts();
    diagLastTotal = 0;
    Serial.println("DIAG reset.");
  }
}

// =====================
// Setup / loop
// =====================
void setup() {
  Serial.begin(115200);
  delay(200);

  pinMode(SENSOR_PIN, INPUT_PULLUP);
  delay(20);

  Serial.println("Starting ETI Arduino Ethernet sender...");
  Serial.println("Sensor input is D2. Move the ETI sensor wire off D13 and onto D2.");
  Serial.println("D13 is Ethernet SPI clock and cannot read pulses while Ethernet is active.");
  Serial.print("Server target: ");
  Serial.print(PROJECT_HOST);
  Serial.print(":");
  Serial.println(PROJECT_PORT);
  if (USE_LOCAL_DATABASE_ONLY) {
    Serial.println("LOCAL DATABASE MODE: sends to Django only; Firebase is not used.");
  }
  if (LOCAL_FAST_SEND_MODE) {
    Serial.println("FAST LOCAL SEND: speed sends every 2 sec, footage sends every 15 sec.");
  }
  setupOledDisplay();

  int sensorInterrupt = digitalPinToInterrupt(SENSOR_PIN);
  if (sensorInterrupt == NOT_AN_INTERRUPT) {
    Serial.println("ERROR: selected sensor pin does not support interrupts.");
  } else {
    attachInterrupt(sensorInterrupt, countPulse, SENSOR_INTERRUPT_MODE);
    Serial.print("Pulse interrupt attached on D");
    Serial.println(SENSOR_PIN);
  }

  if (Ethernet.begin(MAC_ADDRESS) == 0) {
    Serial.println("DHCP failed. Check cable/network.");
  } else {
    Serial.print("IP: ");
    Serial.println(Ethernet.localIP());
  }

  if (USE_LOCAL_DATABASE_ONLY) {
    Serial.println("NTP skipped: local database mode uses Django server time.");
  } else {
    udp.begin(LOCAL_NTP_PORT);
    syncTimeNtp();
  }

  lastSpeedTime = millis();
  lastDailyTime = millis();
  lastNtpAttempt = millis();

  Serial.println("Ready. Serial command: r = reset diagnostics.");
  Serial.println("Boot send test starting now.");
  publishSpeed(1000UL);
}

void loop() {
  handleSerialCommands();
  printDiagnostics();

  unsigned long nowMs = millis();

  if (!USE_LOCAL_DATABASE_ONLY && nowMs - lastNtpAttempt >= NTP_RESYNC_MS) {
    lastNtpAttempt = nowMs;
    syncTimeNtp();
  }

  if (nowMs - lastSpeedTime >= SPEED_INTERVAL_MS) {
    unsigned long elapsedMs = nowMs - lastSpeedTime;
    lastSpeedTime = nowMs;
    publishSpeed(elapsedMs);
  }

  if (nowMs - lastDailyTime >= DAILY_INTERVAL_MS) {
    unsigned long elapsedMs = nowMs - lastDailyTime;
    lastDailyTime = nowMs;
    publishDaily(elapsedMs);
  }
}
