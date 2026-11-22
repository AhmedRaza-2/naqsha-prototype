import re


def encodable(text):
    """Every number must be a token the model knows: 0, or 0.5 to 150 on the 0.5 ft grid."""
    nums = re.findall(r"\d+(?:\.\d+)?", text.replace("x", " "))
    return all((float(v) == 0 or 0.5 <= float(v) <= 150) and float(v) * 2 == int(float(v) * 2) for v in nums)
