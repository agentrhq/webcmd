package main

import (
	"context"
	"os/signal"
	"syscall"

	"github.com/bdoerfchen/webcmd/src/cmd"
)

func main() {
	ctx, cancel := signal.NotifyContext(context.Background(), syscall.SIGINT, syscall.SIGTERM, syscall.SIGQUIT, syscall.SIGHUP)
	defer cancel()

	cmd.Start(ctx)
}
