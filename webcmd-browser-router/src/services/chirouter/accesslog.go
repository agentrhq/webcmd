package chirouter

import (
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

func AccessLogMiddleware(logger *slog.Logger) func(next http.Handler) http.Handler {
	// Return actual middleware
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
			startTime := time.Now()
			responseTracker := &trackingResponseWriter{ResponseWriter: w}

			// Call the next handler
			next.ServeHTTP(responseTracker, req)

			elapsed := time.Since(startTime)
			url := req.URL.String()
			// Log after the request is done
			logger.Info(fmt.Sprintf("%s %s -> %v", req.Method, url, responseTracker.StatusCode()),
				slog.Duration("responseTime", elapsed),
				slog.Int("size", responseTracker.BytesWritten()),
				slog.String("userAgent", req.UserAgent()),
			)
		})
	}
}

// A ResponseWriter that tracks the number of bytes written
type trackingResponseWriter struct {
	http.ResponseWriter
	bytesWritten int
	statusCode   int
}

// Overrides the Write method to track bytes written
func (w *trackingResponseWriter) Write(b []byte) (int, error) {
	n, err := w.ResponseWriter.Write(b)
	w.bytesWritten += n
	return n, err
}

// WriteHeader overrides the WriteHeader method to capture the status code
func (w *trackingResponseWriter) WriteHeader(statusCode int) {
	w.statusCode = statusCode
	w.ResponseWriter.WriteHeader(statusCode)
}

// Returns the number of bytes written
func (w *trackingResponseWriter) BytesWritten() int {
	return w.bytesWritten
}

// Returns the HTTP status code written to the response
func (w *trackingResponseWriter) StatusCode() int {
	if w.statusCode == 0 {
		return http.StatusOK // Default to 200 if status code wasn't explicitly written
	}
	return w.statusCode
}
