#!/bin/bash
cd "$(dirname "$0")"
if lsof -Pi :8080 -sTCP:LISTEN -t >/dev/null ; then
    echo "Phần mềm đang chạy sẵn! Đang mở trình duyệt..."
    open "http://localhost:8080"
else
    (sleep 1 && open "http://localhost:8080") &
    /usr/bin/python3 server.py
fi
