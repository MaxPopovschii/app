import pathlib
import subprocess
import sys

paths = subprocess.check_output(["git", "ls-files", "-z"]).decode().split("\0")
violations = []
for name in filter(None, paths):
    path = pathlib.PurePosixPath(name)
    parts = path.parts
    if any(part in {"node_modules", ".venv", "__pycache__"} for part in parts):
        violations.append(name)
    elif path.name == ".env" or path.name in {".env.local", ".env.production", ".env.development"}:
        violations.append(name)
    elif path.suffix in {".sqlite", ".sqlite3", ".pyc"} or path.name == ".coverage":
        violations.append(name)
if violations:
    print("Remove local credentials and generated files from Git tracking:")
    print("\n".join(violations[:50]))
    sys.exit(1)
print("No tracked local environment files, dependency directories, Python caches or SQLite databases.")
