import re


def zpl_text(value):
    return re.sub(r"[\^~]", " ", str(value or "")).strip()


def zpl_copies(value):
    try:
        return max(1, min(20, int(value or 1)))
    except (TypeError, ValueError):
        return 1


def skid_label_zpl(skid, scan_url, *, darkness="20", speed="5", copies=1):
    return "\n".join([
        "^XA",
        "^CI28",
        "^PW609",
        "^LL609",
        "^LH0,0",
        f"~SD{zpl_text(darkness) or '20'}",
        f"^PR{zpl_text(speed) or '5'}",
        "^FO30,18^A0N,24,24^FB549,1,0,C^FDSKID^FS",
        f"^FO30,48^A0N,46,46^FB549,1,0,C^FD{zpl_text(skid.skid_number)}^FS",
        f"^FO103,105^BQN,2,8^FDLA,{zpl_text(scan_url)}^FS",
        "^FO30,558^A0N,23,23^FB549,1,0,C^FDSCAN FOR LIVE CONTENTS^FS",
        f"^PQ{zpl_copies(copies)}",
        "^XZ",
    ])


def rack_label_zpl(rack, scan_url, *, darkness="20", speed="5", copies=1):
    return "\n".join([
        "^XA",
        "^CI28",
        "^PW609",
        "^LL609",
        f"~SD{zpl_text(darkness) or '20'}",
        f"^PR{zpl_text(speed) or '5'}",
        "^FO30,18^A0N,24,24^FB549,1,0,C^FDRACK^FS",
        f"^FO30,48^A0N,46,46^FB549,1,0,C^FD{zpl_text(rack.rack_code)}^FS",
        f"^FO103,105^BQN,2,8^FDLA,{zpl_text(scan_url)}^FS",
        "^FO30,558^A0N,23,23^FB549,1,0,C^FDSCAN TO MOVE SKIDS^FS",
        f"^PQ{zpl_copies(copies)}",
        "^XZ",
    ])
