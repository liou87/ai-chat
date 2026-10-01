"""
生成登录密码的哈希，填到环境变量 APP_PASSWORD_HASH（本地 .env 和 Vercel 项目设置里）。
密码用 getpass 输入，不回显、不进命令历史；输出的是 scrypt 哈希，不是密码本身。

用法：python scripts/hash_password.py
"""
import getpass
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from services.auth import hash_password, verify_password  # noqa: E402

MIN_LENGTH = 12


def main():
    password = getpass.getpass("新密码（至少 12 位）：")
    if len(password) < MIN_LENGTH:
        sys.exit(f"太短了，至少 {MIN_LENGTH} 位")
    if getpass.getpass("再输一遍：") != password:
        sys.exit("两次输入不一致")
    hashed = hash_password(password)
    assert verify_password(password, hashed)
    print("\n把下面这一整行填到 APP_PASSWORD_HASH：\n")
    print(hashed)


if __name__ == "__main__":
    main()
