#!/bin/sh
set -e

. "$(dirname -- "$0")/project-env.sh"
exec npm run dev

