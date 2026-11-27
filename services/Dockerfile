# syntax=docker/dockerfile:1

# Shared build recipe for the six independent Go modules.
# The SERVICE build arg selects which module under services/ to build.
#
# Manual build (from the repo root):
#   docker build --build-arg SERVICE=gateway -f services/Dockerfile .
ARG SERVICE

FROM golang:1.27.4-alpine AS build
ARG SERVICE
WORKDIR /src

COPY services/${SERVICE}/go.mod services/${SERVICE}/go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download

COPY services/${SERVICE}/ ./
RUN --mount=type=cache,target=/go/pkg/mod \
    --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=linux go build -buildvcs=false -trimpath -ldflags="-s -w" -o /out/service .

FROM alpine:3.22
RUN apk add --no-cache ca-certificates
COPY --from=build /out/service /usr/local/bin/service
USER 65532:65532
ENTRYPOINT ["/usr/local/bin/service"]
