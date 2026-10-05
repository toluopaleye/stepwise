"""Concatenate the interpreter sources into dist/pyrun.js (browser global + Node module)."""
import pathlib

ROOT = pathlib.Path(__file__).resolve().parent.parent
ORDER = ["pydata.js", "core.js", "values.js", "interp.js", "builtins.js", "api.js"]


def bundle() -> str:
    parts = [(ROOT / "src" / "py" / name).read_text() for name in ORDER]
    body = "\n".join(parts)
    return (
        "(function (root) {\n'use strict';\n" + body +
        "\nroot.PyRun = PyRun;\nif (typeof module !== 'undefined' && module.exports) module.exports = PyRun;\n"
        "})(typeof window !== 'undefined' ? window : globalThis);\n"
    )


if __name__ == "__main__":
    out = ROOT / "dist" / "pyrun.js"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(bundle())
    print("wrote", out, out.stat().st_size, "bytes")
