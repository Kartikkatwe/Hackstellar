"""Order IDs with a check digit: PREFIX-NNNNNN-C (C = Luhn digit over the six digits).
A typo fails validation instead of silently matching another customer's order."""
import re


def luhn_digit(digits: str) -> str:
    total = 0
    for i, ch in enumerate(reversed(digits)):
        d = int(ch)
        if i % 2 == 0:
            d *= 2
            if d > 9:
                d -= 9
        total += d
    return str((10 - total % 10) % 10)


def make(prefix: str, number: int, digits: int = 6) -> str:
    body = str(number).zfill(digits)
    return f"{prefix}-{body}-{luhn_digit(body)}"


def pattern(prefix: str, digits: int = 6) -> re.Pattern:
    # tolerant of spaces, missing dashes and lower case, as people type them
    return re.compile(rf"\b{prefix}[\s\-]?(\d{{{digits}}})[\s\-]?(\d)\b", re.IGNORECASE)


def find(text: str, prefix: str, digits: int = 6) -> list[tuple[str, bool]]:
    """Return [(normalised_id, check_digit_valid)] for every candidate in the text."""
    out = []
    for body, check in pattern(prefix, digits).findall(text or ""):
        out.append((f"{prefix}-{body}-{check}", luhn_digit(body) == check))
    return out
