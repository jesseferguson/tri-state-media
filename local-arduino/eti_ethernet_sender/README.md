# ETI Arduino Ethernet Sender

Open this sketch in the Arduino IDE:

`local-arduino/eti_ethernet_sender/eti_ethernet_sender.ino`

Board:

`Arduino Ethernet` / FQBN `arduino:avr:ethernet`

Do not compile the old ESP32 sketch for this board. If the compile log shows `#include <WiFi.h>`, the wrong sketch is open.

The ETI sensor is set to D2 in this sketch. Move the sensor wire off D13 and onto D2. On Arduino Ethernet boards, D13 is SPI clock for Ethernet and cannot reliably read pulses while the network is active.

OLED display wiring for the ELEGOO 0.96 inch SSD1306 I2C screen:

- `GND` to Arduino `GND`
- `VCC` to Arduino `5V` if the module supports 5V, otherwise `3.3V`
- `SDA` to Arduino `SDA` / `A4`
- `SCL` to Arduino `SCL` / `A5`

The sketch looks for the OLED at I2C address `0x3C`, then `0x3D`. It uses the built-in Arduino `Wire` library, so no OLED graphics library is required.

Fast test mode is controlled by `TEST_FAST_SEND_MODE`. Leave it `false` for production: current speed sends every 30 seconds and footage sends every 7 minutes.

Local database mode is controlled by `USE_LOCAL_DATABASE_ONLY`. When it is `true`, the board sends to this project only:

- `/api/local-live-footage/eti/speed/`
- `/api/local-live-footage/eti/daily/`

That mode does not write to Firebase.

When local database mode is on, the board sends a boot test immediately, then sends speed every 2 seconds and footage every 15 seconds for easier testing.
