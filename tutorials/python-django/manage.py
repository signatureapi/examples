#!/usr/bin/env python3
import os
import sys

if __name__ == "__main__":
    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "settings")
    from django.core.management import execute_from_command_line

    if "runserver" in sys.argv:  # fail fast on a missing or live key
        from signatureapi import get_config

        get_config()
    execute_from_command_line(sys.argv)
