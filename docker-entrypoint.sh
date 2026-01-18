#!/bin/bash
# Docker entrypoint script for user containers
# Creates proper user mapping so the shell shows the correct username

# Get user info from environment
USERNAME="${USER:-node}"
USER_UID=$(id -u)
USER_GID=$(id -g)
USER_HOME="${HOME:-/home/node}"

# Always add user entry to /etc/passwd if it doesn't exist
if ! grep -q "^${USERNAME}:" /etc/passwd 2>/dev/null; then
    echo "${USERNAME}:x:${USER_UID}:${USER_GID}:${USERNAME}:${USER_HOME}:/bin/bash" >> /etc/passwd 2>/dev/null || true
fi

# Add group entry if it doesn't exist
if ! grep -q ":x:${USER_GID}:" /etc/group 2>/dev/null; then
    echo "${USERNAME}:x:${USER_GID}:" >> /etc/group 2>/dev/null || true
fi

# Execute the main command
exec "$@"
