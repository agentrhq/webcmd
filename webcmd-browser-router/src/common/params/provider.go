package params

import (
	"net/http"
)

// A map from environment variable names to their values
type EnvMap = map[string]string

// A component that is providing environment variables from the parameters of a requests. It is expected to be initialized from []config.RouteParameter
type ParameterProvider interface {
	// Get a map of all environment variables with the values from the given [http.Request]
	For(request *http.Request) EnvMap
	// Get a list of all environment variables that will be produced for any [http.Request]
	EnvNames() []string
}
