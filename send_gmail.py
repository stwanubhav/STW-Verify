import os
import smtplib
import sys
from email.message import EmailMessage
from email.utils import formataddr

SMTP_HOST = "smtp.gmail.com"
SMTP_PORT = 587


def get_conf():
    sender = os.environ.get("GMAIL_SENDER")
    password = os.environ.get("GMAIL_APP_PASSWORD")
    if not sender or not password:
        sys.exit(
            "Missing credentials. Set GMAIL_SENDER and GMAIL_APP_PASSWORD "
            "environment variables before running."
        )
    return sender, password


def build_message(sender: str, target: str, recipient_name: str) -> EmailMessage:
    msg = EmailMessage()
    msg["Subject"] = "Greetings from Python"
    msg["From"] = formataddr(("Python Sender", sender))
    msg["To"] = formataddr((recipient_name, target))
    msg.set_content(
        f"Hello {recipient_name},\n\n"
        "This is a greeting message sent from a Python program.\n\n"
        "Best regards,\nPython Sender"
    )
    msg.add_alternative(
        f"""<html><body>
<p>Hello <b>{recipient_name}</b>,</p>
<p>This is a <b>greeting</b> message sent from a Python program.</p>
<p>Best regards,<br>Python Sender</p>
</body></html>""",
        subtype="html",
    )
    return msg


def main() -> None:
    if len(sys.argv) < 2:
        sys.exit("Usage: python send_gmail.py <target@example.com> [recipient name]")

    target = sys.argv[1]
    recipient_name = sys.argv[2] if len(sys.argv) > 2 else target.split("@")[0]

    sender, password = get_conf()
    msg = build_message(sender, target, recipient_name)

    with smtplib.SMTP(SMTP_HOST, SMTP_PORT) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(sender, password)
        server.send_message(msg)

    print(f"Greeting sent to {recipient_name} <{target}>")


if __name__ == "__main__":
    main()
