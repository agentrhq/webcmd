package config

import (
	"fmt"
	"net/http"
	"os/exec"
	"regexp"
	"runtime"
	"slices"
	"strings"
)

// Perform check on all fields and return a collection of remarks
func (r *Route) Check() (result RouteErrorCollection) {
	// Check method
	r.Method = strings.ToUpper(r.Method)
	if !slices.Contains(allowedMethods, r.Method) {
		result = append(result, RouteError{Message: fmt.Sprintf("http method '%s' is not allowed", r.Method), Level: ErrorLevelCritical})
	}

	// Add info when body is not allowed for POST or PUT route
	if (r.Method == http.MethodPost || r.Method == http.MethodPut) && !r.AllowBody {
		result = append(result, RouteError{Message: "body will be ignored", Level: ErrorLevelInfo})
	}

	// Check route
	if len(r.Route) == 0 {
		result = append(result, RouteError{Message: "route must not be empty and will be set to '/'", Level: ErrorLevelWarning})
		r.Route = "/"
	} else if r.Route[0] != '/' {
		r.Route = "/" + r.Route
	}

	// Check caching
	if r.Caching && r.Method != http.MethodGet {
		result = append(result, RouteError{Message: "caching only works on GET requests", Level: ErrorLevelWarning})
	}

	// Check exec
	if r.Exec.Proc == nil && r.Exec.Shell == nil {
		result = append(result, RouteError{Message: "exec requires 'proc' or 'shell' config", Level: ErrorLevelCritical})
	} else if r.Exec.Proc != nil && r.Exec.Shell != nil {
		result = append(result, RouteError{Message: "'shell' config will be ignored when providing 'proc' config", Level: ErrorLevelWarning})
	}

	// Check exec.proc
	if r.Exec.Proc != nil {
		if r.Exec.Proc.Path == "" {
			result = append(result, RouteError{Message: "executable path must not be empty", Level: ErrorLevelCritical})
		} else if _, err := exec.LookPath(r.Exec.Proc.Path); err != nil {
			result = append(result, RouteError{Message: fmt.Sprintf("executable '%s' can not be found as file or on PATH", r.Exec.Proc.Path), Level: ErrorLevelWarning})
		}
	} else if r.Exec.Shell != nil {
		if r.Exec.Shell.Command == "" {
			result = append(result, RouteError{Message: "shell command must not be empty", Level: ErrorLevelCritical})
		}
	}

	// Check exit codes
	for _, codeMapping := range r.StatusCodes {
		// Check for valid response stream names
		if !codeMapping.ResponseStream.IsValid() {
			result = append(result, RouteError{Message: fmt.Sprintf("exit code %v with invalid response stream '%s'", *codeMapping.ExitCode, codeMapping.ResponseStream), Level: ErrorLevelCritical})
		}
	}

	// Check default status code
	if !slices.ContainsFunc(r.StatusCodes, func(i ExitCodeMapping) bool { return i.ExitCode == nil }) {
		result = append(result, RouteError{Message: "no default status code for non-zero exit codes defined: uses 500 now", Level: ErrorLevelInfo})
	}

	// Check query params
	for _, param := range r.Parameters {
		// Check name not empty
		if param.Name == "" {
			result = append(result, RouteError{Message: "empty parameter name is not allowed", Level: ErrorLevelCritical})
		}

		// Check source is valid
		if !slices.Contains(allowedParamSources, param.Source) {
			result = append(result, RouteError{Message: fmt.Sprintf("param '%s' has invalid source: %s", param.Name, param.Source), Level: ErrorLevelCritical})
		}

		// Check "as" is valid
		if param.As != "" && !validEnvName.MatchString(param.As) {
			result = append(result, RouteError{Message: fmt.Sprintf("param '%s' has invalid redefined env variable name: %s", param.Name, param.As), Level: ErrorLevelCritical})
		}

		// TODO: check and print resulting env variable names?
	}

	// OS specific remarks
	if runtime.GOOS == "windows" {
		if r.Exec.Shell != nil {
			result = append(result, RouteError{Message: "the 'shell' exec mode is not supported on windows", Level: ErrorLevelCritical})
		}
	}

	return
}

// Regex for valid env names
var validEnvName = regexp.MustCompile(`^[\w_][\d\w_]+$`)
