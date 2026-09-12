FROM golang:1.24.0-alpine as builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download && go mod verify

COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o bin/webcmd

FROM debian:stable-slim
COPY --from=builder --chmod=755 /build/bin/webcmd /usr/local/bin/

RUN useradd -rm webcmd
USER webcmd
ENTRYPOINT [ "webcmd" ]
CMD [ "run", "-v" ]