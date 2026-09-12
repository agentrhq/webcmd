package config

import (
	"net/http"
	"slices"
	"strings"
)

const RouteParamPrefix = "WC_"

var allowedMethods = []string{http.MethodGet, http.MethodPost, http.MethodPut, http.MethodDelete}

type Route struct {
	Method         string            // HTTP method
	Route          string            // Route pattern, includes the url path parameters
	Headers        map[string]string // Default response headers for this route
	Parameters     []RouteParameter  // List of parameters to load and inject as environment variables
	StatusCodes    []ExitCodeMapping // List of exit-code to status-code mappings
	AllowBody      bool              // Enable reading the request body and writing it into stdin of the exec environment
	Exec           RouteExec         // Exec config
	ResponseStream StdStream         // Default output stream used in response for all exit codes
	Caching        bool              // Enable caching for this route. Is disabled by default.
}

type ExitCodeMapping struct {
	ExitCode       *int              // The base exit code from which to map from
	StatusCode     int               // Status code to map to
	Headers        map[string]string // Special response headers for this exit code
	ResponseStream StdStream         // Output stream used in response for this exit code
}

// Stream constants
type StdStream string

const (
	StdOut StdStream = "stdout"
	StdErr StdStream = "stderr"
	Both   StdStream = "both"
	None   StdStream = "none"
)

var allowedStreams = []StdStream{StdOut, StdErr, Both, None}

func (stream StdStream) IsValid() bool {
	return stream == "" || slices.Contains(allowedStreams, StdStream(strings.ToLower(string(stream))))
}

// Return a default route configuration that can be used as the base for further configuration.
func DefaultRoute() Route {
	var zero int = 0
	return Route{
		Method: http.MethodGet,
		Route:  "/*",
		Exec:   RouteExec{},
		StatusCodes: []ExitCodeMapping{
			{ExitCode: &zero, StatusCode: 200},
		},
		ResponseStream: Both,
	}
}

// Prints "METHOD PATH" (example: GET /)
func (r *Route) String() string {
	return r.Method + " " + r.Route
}
