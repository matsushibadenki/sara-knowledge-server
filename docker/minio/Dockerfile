FROM golang:1.24.7-alpine@sha256:fc2cff6625f3c1c92e6c85938ac5bd09034ad0d4bc2dfb08278020b68540dbb5 AS build
RUN apk add --no-cache git ca-certificates
ENV CGO_ENABLED=0 GOTOOLCHAIN=local

# Official release sources, pinned to the commits behind the previous image tags.
RUN git clone --depth 1 --branch RELEASE.2025-09-07T16-13-09Z https://github.com/minio/minio.git /src/minio \
    && test "$(git -C /src/minio rev-parse HEAD)" = 07c3a429bfed433e49018cb0f78a52145d4bedeb
WORKDIR /src/minio
RUN go build -mod=readonly -trimpath -o /out/minio .

RUN git clone --depth 1 --branch RELEASE.2025-08-13T08-35-41Z https://github.com/minio/mc.git /src/mc \
    && test "$(git -C /src/mc rev-parse HEAD)" = 7394ce0dd2a80935aded936b09fa12cbb3cb8096
WORKDIR /src/mc
RUN go build -mod=readonly -trimpath -o /out/mc .

FROM alpine:3.22.2@sha256:4b7ce07002c69e8f3d704a9c5d6fd3053be500b7f1c69fc0d80990c2ad8dd412
COPY --from=build /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/ca-certificates.crt
COPY --from=build /out/minio /out/mc /usr/local/bin/
COPY --from=build /src/minio/LICENSE /licenses/minio-LICENSE
COPY --from=build /src/mc/LICENSE /licenses/mc-LICENSE
EXPOSE 9000 9001
ENTRYPOINT ["minio"]
