package server

import (
	"context"
	"fmt"
	"net/http"
	"time"

	"github.com/bdoerfchen/webcmd/src/logging"
)

type server struct {
	config Config
}

func New(config Config) *server {
	return &server{
		config: config,
	}
}

func (s *server) Run(ctx context.Context, handler http.Handler) error {
	// Logger setup
	host := fmt.Sprintf("%s:%v", s.config.Host, s.config.Port)
	logger := logging.FromContext(ctx)
	logger.Info(fmt.Sprintf("listening on %s", host))

	// Setup
	server := http.Server{
		Addr:        host,
		Handler:     handler,
		ReadTimeout: 5 * time.Second,
	}
	go func() {
		// Goroutine watching the context cancellation in parallel
		<-ctx.Done()
		// ...and shutting down the server
		logger.Error("context cancelled")
		server.Shutdown(ctx)
	}()

	// Listen
	return server.ListenAndServe()
}
