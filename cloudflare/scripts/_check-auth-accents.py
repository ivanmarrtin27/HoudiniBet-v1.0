# -*- coding: utf-8 -*-
from pathlib import Path
root = Path(__file__).resolve().parents[1]
files = [
    root / "public" / "index.html",
    root / "public" / "app.js",
    root / "src" / "services" / "authService.js",
    root / "src" / "index.js",
]
patterns = [
    "Maximo", "Minimo", "maximo", "minimo",
    "telefono", "Telefono", "contrasena", "Contrasena",
    "Sera ", "sera ", "todavia", " mas ", "esta configur",
    "no valido", "No valido", "Ã", "Â",
    "usuario01", "usuario_01", "ivan_m",
    "Máximo", "Mínimo", "Teléfono", "Contraseña",
]
for f in files:
    text = f.read_text(encoding="utf-8")
    print(f"=== {f.name} ===")
    for p in patterns:
        c = text.count(p)
        if c:
            print(f"  {p!r}: {c}")
    # show register username attrs
    if f.name == "index.html":
        i = text.find("auth-register-username")
        print("  snippet:", repr(text[i:i+420]))
    if f.name == "app.js":
        for needle in ["Sera visible", "todavía", "todavia", "Será"]:
            j = text.find(needle)
            if j >= 0:
                print("  ctx:", repr(text[j-40:j+80]))
