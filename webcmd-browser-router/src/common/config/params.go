package config

type RouteParameter struct {
	Name    string      // Name of the parameter at its source
	Source  ParamSource // The place where the parameter is coming from
	As      string      // By default the env variable is WC_NAME (WC_ as the prefix and the uppercase param name). Using As can override this behaviour and sets a custom env variable name
	Default string      // The default value is used when the request-provided value is empty ("")

	DisableSanitization bool // Value sanitization can be disabled if it results in unwanted behaviour
}

type ParamSource string

const (
	ParamSourceQuery  ParamSource = "query"
	ParamSourceRoute  ParamSource = "route"
	ParamSourceHeader ParamSource = "header"
	ParamSourceNone   ParamSource = ""
)

var allowedParamSources = []ParamSource{ParamSourceQuery, ParamSourceRoute, ParamSourceHeader, ParamSourceNone}
