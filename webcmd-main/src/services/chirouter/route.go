package chirouter

import (
	"bytes"
	"net/http"
	"strings"

	"github.com/bdoerfchen/webcmd/src/common/config"
	"github.com/bdoerfchen/webcmd/src/common/params"
	"github.com/bdoerfchen/webcmd/src/common/process"
	"github.com/bdoerfchen/webcmd/src/services/paramcollection"
)

const DefaultKey = -1

type OptimizedRoute struct {
	config.Route
	StatusCodeMap map[int]OptimizedMapping
	parameters    params.ParameterProvider
}

type OptimizedMapping struct {
	config.ExitCodeMapping
}

func OptimizeRoute(route config.Route) (result OptimizedRoute) {
	result.Route = route
	result.StatusCodeMap = make(map[int]OptimizedMapping)

	// Convert all mappings and add them to map
	for _, codeMap := range route.StatusCodes {
		key := DefaultKey
		if codeMap.ExitCode != nil {
			key = *codeMap.ExitCode
		}

		if codeMap.StatusCode < http.StatusOK {
			// Server should not answer below 200 when request is finished
			codeMap.StatusCode = http.StatusOK
		}
		if codeMap.StatusCode >= 1000 {
			// Arbitrary limit
			codeMap.StatusCode = 999
		}

		// Use default output stream if left empty
		if codeMap.ResponseStream == "" {
			codeMap.ResponseStream = route.ResponseStream
		}

		// Add entry
		result.StatusCodeMap[key] = OptimizedMapping{codeMap}
	}

	// Add defaults
	if _, ok := result.StatusCodeMap[DefaultKey]; !ok {
		result.StatusCodeMap[DefaultKey] = OptimizedMapping{
			config.ExitCodeMapping{
				StatusCode:     http.StatusInternalServerError,
				ResponseStream: config.Both,
			},
		}
	}

	// Optimize parameter retrieval
	result.parameters = paramcollection.New(route)

	return
}

func (o *OptimizedRoute) ExitCodeResponse(code int) OptimizedMapping {
	if response, ok := o.StatusCodeMap[code]; ok {
		return response
	}

	return o.StatusCodeMap[DefaultKey]
}

func (o *OptimizedMapping) ResponseBufferFor(proc *process.Process) *bytes.Buffer {
	if o == nil {
		return nil
	}

	switch strings.ToLower(string(o.ExitCodeMapping.ResponseStream)) {
	case string(config.StdOut):
		return &proc.StdOut
	case string(config.StdErr):
		return &proc.StdErr
	case string(config.None):
		return nil
	default:
		return &proc.StdOutErr
	}
}
