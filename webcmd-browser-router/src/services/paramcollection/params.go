package paramcollection

import (
	"net/http"
	"regexp"
	"slices"
	"strings"

	"github.com/bdoerfchen/webcmd/src/common/config"
	"github.com/go-chi/chi/v5"
)

type ParameterCollection struct {
	parameters []config.RouteParameter
}

var illegalEnvNameChars = regexp.MustCompile(`[^\w\d_]`)

func New(route config.Route) *ParameterCollection {
	// Copy parameters list and add missing route parameters
	parameters := slices.Clone(route.Parameters)
	for _, param := range paramNamesInRoute(route.Route) {
		if !slices.ContainsFunc(parameters, func(p config.RouteParameter) bool { return p.Name == param }) {
			parameters = append(parameters, config.RouteParameter{
				Name:   param,
				Source: config.ParamSourceRoute,
			})
		}
	}

	// Compute environment variable names
	for i, param := range parameters {
		// Save calculated name in param.As
		parameters[i].As = paramEnvName(param)
	}

	return &ParameterCollection{
		parameters: parameters,
	}
}

func paramEnvName(param config.RouteParameter) string {
	// Define name of env variable from custom or default
	envName := config.RouteParamPrefix + strings.ToUpper(param.Name)
	if param.As != "" {
		envName = param.As

		// Add prefix if begins with number
		if envName[0] >= '0' && envName[0] <= '9' {
			envName = config.RouteParamPrefix + envName
		}
	}

	// Clean name by replacing illegal characters
	envName = illegalEnvNameChars.ReplaceAllString(envName, "_")

	return envName
}

// Read all parameters from an http.Request in the order defined in the route. Later params overwrite earlier ones
func (c *ParameterCollection) For(r *http.Request) map[string]string {
	result := make(map[string]string)

	// Iterate over all parameters
	for _, param := range c.parameters {
		var value string
		switch param.Source {
		case config.ParamSourceHeader:
			value = r.Header.Get(param.Name)
		case config.ParamSourceQuery:
			value = r.URL.Query().Get(param.Name)
		case config.ParamSourceRoute:
			value = chi.URLParam(r, param.Name)
		}

		if value != "" {
			// Clean user input if not disabled
			if !param.DisableSanitization {
				value = sanitize(value)
			}
		} else {
			// Use default if empty
			value = param.Default
		}

		result[param.As] = value
	}

	return result
}

func (c *ParameterCollection) EnvNames() []string {
	result := make([]string, len(c.parameters))
	for i, param := range c.parameters {
		result[i] = param.As
	}

	return result
}

// Route parameters are defined as {name:regex} -> we want the name with the first capture group
var routeParamMatcher = regexp.MustCompile(`{([^\/\\:]+)(?:\:[^}\/]+)*}`)

func paramNamesInRoute(routePattern string) (result []string) {
	groups := routeParamMatcher.FindAllStringSubmatch(routePattern, -1)
	if groups == nil {
		return
	}

	for _, g := range groups {
		result = append(result, g[1])
	}

	return
}
