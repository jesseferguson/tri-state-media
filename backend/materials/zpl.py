import re


def zpl_text(value):
    return re.sub(r"[\^~]", " ", str(value or "")).strip()


def zpl_copies(value):
    try:
        return max(1, min(20, int(value or 1)))
    except (TypeError, ValueError):
        return 1


def skid_label_zpl(skid, scan_url, *, darkness="20", speed="5", copies=1):
    location = skid.current_location_display
    created = skid.created_at.strftime("%Y-%m-%d") if skid.created_at else ""
    roll_count = skid.rolls.filter(is_active=True).exclude(status__in=["depleted", "scrapped"]).count()
    return "\n".join([
        "^XA",
        "^CI28",
        "^PW812",
        "^LL609",
        f"~SD{zpl_text(darkness) or '20'}",
        f"^PR{zpl_text(speed) or '5'}",
        "^FO30,28^A0N,42,42^FDSKID LABEL^FS",
        f"^FO30,82^A0N,56,56^FD{zpl_text(skid.skid_number)}^FS",
        f"^FO30,160^BQN,2,7^FDLA,{zpl_text(scan_url)}^FS",
        f"^FO365,170^A0N,29,29^FDStatus: {zpl_text(skid.get_status_display())}^FS",
        f"^FO365,218^A0N,29,29^FDLocation: {zpl_text(location)}^FS",
        f"^FO365,266^A0N,29,29^FDRolls: {roll_count}^FS",
        f"^FO365,314^A0N,27,27^FDCreated: {zpl_text(created)}^FS",
        "^FO30,535^GB752,2,2^FS",
        "^FO30,553^A0N,27,27^FDScan to view skid contents^FS",
        f"^PQ{zpl_copies(copies)}",
        "^XZ",
    ])


def rack_label_zpl(rack, scan_url, *, darkness="20", speed="5", copies=1):
    detail = rack.location_detail or "Plant material storage"
    return "\n".join([
        "^XA",
        "^CI28",
        "^PW812",
        "^LL609",
        f"~SD{zpl_text(darkness) or '20'}",
        f"^PR{zpl_text(speed) or '5'}",
        "^FO30,28^A0N,42,42^FDRACK LOCATION^FS",
        f"^FO30,82^A0N,62,62^FD{zpl_text(rack.rack_code)}^FS",
        f"^FO30,170^BQN,2,8^FDLA,{zpl_text(scan_url)}^FS",
        f"^FO390,185^A0N,30,30^FD{zpl_text(detail)}^FS",
        f"^FO390,240^A0N,28,28^FDStatus: {zpl_text(rack.get_status_display())}^FS",
        "^FO30,535^GB752,2,2^FS",
        "^FO30,553^A0N,27,27^FDScan to assign skid^FS",
        f"^PQ{zpl_copies(copies)}",
        "^XZ",
    ])
