#!/bin/sh
# Optional self-hosted S3 (SeaweedFS) for docker-compose.prod.yml --profile s3.
# One identity with the S3_* credentials, anonymous read (public product images),
# and the S3_BUCKET bucket created on first start.
set -e
cat > /tmp/s3.json <<EOF
{"identities":[
  {"name":"medusa","credentials":[{"accessKey":"$S3_ACCESS_KEY_ID","secretKey":"$S3_SECRET_ACCESS_KEY"}],"actions":["Admin","Read","Write","List","Tagging"]},
  {"name":"anonymous","actions":["Read"]}
]}
EOF
(until echo "s3.bucket.create -name $S3_BUCKET" | weed shell -master=localhost:9333 >/tmp/bucket.log 2>&1 && ! grep -qi error /tmp/bucket.log; do sleep 2; done; echo "bucket $S3_BUCKET ready") &
exec weed server -dir=/data -s3 -s3.port=8333 -s3.config=/tmp/s3.json
