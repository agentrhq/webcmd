package logging

import (
	"context"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"time"
)

type webcmdLogHandler struct {
	writer      io.Writer
	options     *slog.HandlerOptions
	attrs       []slog.Attr
	colorOutput bool
}

func newLogHandler(writer io.Writer, options *slog.HandlerOptions, colorOutput bool) slog.Handler {
	return &webcmdLogHandler{writer: writer, options: options, colorOutput: colorOutput}
}

func (h *webcmdLogHandler) Enabled(_ context.Context, level slog.Level) bool {
	return level >= h.options.Level.Level()
}

func (h *webcmdLogHandler) Handle(_ context.Context, r slog.Record) error {
	msg := r.Message
	timestamp := r.Time.Format(time.RFC3339)
	// Decide which level string and color to use
	var level, color string
	switch r.Level {
	case slog.LevelInfo:
		level = "INFO"
		color = colorWhite
	case slog.LevelWarn:
		level = "WARN"
		color = colorYellow
	case slog.LevelError:
		level = "CRIT"
		color = colorRed
	default:
		level = "DEBG"
		color = colorCyan
	}

	// Concatenate attributes into list
	countAttributes := r.NumAttrs() + len(h.attrs)
	attributeOutput := ""
	if countAttributes > 0 {
		attributes := make([]string, 0, countAttributes)

		// Add both temporary and permanent attributes
		r.Attrs(func(a slog.Attr) bool {
			attributes = append(attributes, fmt.Sprintf("%s=%v", a.Key, a.Value))
			return true
		})
		for _, a := range h.attrs {
			attributes = append(attributes, fmt.Sprintf("%s=%v", a.Key, a.Value))
		}

		attributeOutput = " (" + strings.Join(attributes, ", ") + ")"
	}

	// Output format
	output := fmt.Sprintf("%s - %s  |  %s%s", timestamp, level, msg, attributeOutput)
	if h.colorOutput {
		output = color + output + colorReset
	}

	_, err := fmt.Fprintln(h.writer, output)
	return err
}

// Chaining is not supported
func (h *webcmdLogHandler) WithAttrs(attrs []slog.Attr) slog.Handler {
	return &webcmdLogHandler{
		writer:      h.writer,
		options:     h.options,
		colorOutput: h.colorOutput,
		attrs:       append(h.attrs, attrs...),
	}
}

// Grouping is not supported
func (h *webcmdLogHandler) WithGroup(name string) slog.Handler {
	return h
}

const (
	colorRed    = "\033[31m"
	colorGreen  = "\033[32m"
	colorYellow = "\033[33m"
	colorBlue   = "\033[34m"
	colorPurple = "\033[35m"
	colorCyan   = "\033[36m"
	colorWhite  = "\033[37m"

	colorReset = "\033[0m"
)
