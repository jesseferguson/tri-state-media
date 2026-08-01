from decimal import Decimal, InvalidOperation

from materials.zpl import zpl_copies, zpl_text


def zpl_inches(value):
    if value in [None, ""]:
        return ""
    try:
        number = Decimal(value).normalize()
    except (InvalidOperation, TypeError, ValueError):
        return zpl_text(value)
    return f'{format(number, "f")}"'


def zpl_label_value(value):
    text = zpl_text(value)
    return text or "--"


def flex_die_folder_label_zpl(die, scan_url, *, darkness="20", speed="5", copies=1):
    width = zpl_inches(die.web_width_inches or die.computed_web_width_inches)
    fields = [
        ("ACROSS", die.number_across),
        ("AROUND", die.number_around),
        ("WIDTH", zpl_inches(die.label_width_inches)),
        ("LENGTH", zpl_inches(die.label_length_inches)),
        ("GEAR", f"{die.gear}T" if die.gear else ""),
        ("WEB WIDTH", width),
        ("FACE", die.face_type),
        ("CUT", die.get_cutting_type_display()),
    ]

    lines = [
        "^XA",
        "^CI28",
        "^PW508",
        "^LL1015",
        "^LH0,0",
        f"~SD{zpl_text(darkness) or '20'}",
        f"^PR{zpl_text(speed) or '5'}",
        "^FO24,18^A0N,24,24^FDFLEX DIE FOLDER^FS",
        f"^FO24,50^A0N,54,54^FB288,2,0,L^FD{zpl_label_value(die.name)}^FS",
        f"^FO326,28^BQN,2,5^FDLA,{zpl_text(scan_url)}^FS",
        "^FO24,205^GB460,3,3^FS",
    ]

    box_width = 220
    box_height = 92
    for index, (label, value) in enumerate(fields):
        column = index % 2
        row = index // 2
        x = 24 + (column * 240)
        y = 228 + (row * 108)
        lines.extend([
            f"^FO{x},{y}^GB{box_width},{box_height},2^FS",
            f"^FO{x + 12},{y + 12}^A0N,21,21^FD{zpl_text(label)}^FS",
            f"^FO{x + 12},{y + 40}^A0N,32,32^FB{box_width - 24},1,0,L^FD{zpl_label_value(value)}^FS",
        ])

    lines.extend([
        "^FO24,690^GB460,130,3^FS",
        "^FO42,712^A0N,24,24^FDCURRENT ORIGINAL SERIAL NUMBER^FS",
        f"^FO42,750^A0N,38,38^FB424,2,0,L^FD{zpl_label_value(die.original_serial_number)}^FS",
        "^FO24,842^GB460,3,3^FS",
        "^FO24,868^A0N,24,24^FB460,1,0,C^FDSCAN FOR FLEX DIE INFO^FS",
        f"^FO24,906^A0N,18,18^FB460,3,0,C^FD{zpl_text(scan_url)}^FS",
        f"^PQ{zpl_copies(copies)}",
        "^XZ",
    ])
    return "\n".join(lines)
