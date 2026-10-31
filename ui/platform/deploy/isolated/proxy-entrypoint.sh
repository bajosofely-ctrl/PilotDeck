#!/bin/sh
set -eu

certificate=/etc/letsencrypt/live/qyxc-ip/fullchain.pem
nginx -t
(
    previous=$(sha256sum "$certificate")
    while sleep 300; do
        current=$(sha256sum "$certificate") || continue
        if [ "$current" != "$previous" ]; then
            if nginx -t && nginx -s reload; then
                previous=$current
            fi
        fi
    done
) &
exec nginx -g 'daemon off;'
