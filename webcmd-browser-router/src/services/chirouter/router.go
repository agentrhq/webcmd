package chirouter

import (
	"context"
	"fmt"
	"log/slog"
	"net/http"
	"runtime"
	"strings"

	"github.com/bdoerfchen/webcmd/src/common/cacher"
	"github.com/bdoerfchen/webcmd/src/common/config"
	"github.com/bdoerfchen/webcmd/src/common/execution"
	"github.com/bdoerfchen/webcmd/src/common/version"
	"github.com/bdoerfchen/webcmd/src/logging"
	"github.com/go-chi/chi/v5"
	"github.com/go-chi/chi/v5/middleware"
)

var ServerHeader = fmt.Sprintf("webcmd/%s (%s)", version.Full(), runtime.GOOS)

type chirouter struct {
	router             chi.Router
	executerCollection *execution.ExecuterCollection
	cacher             cacher.Cacher
}

func New(executerCollection *execution.ExecuterCollection, cacher cacher.Cacher) *chirouter {
	return &chirouter{
		router:             chi.NewRouter(),
		executerCollection: executerCollection,
		cacher:             cacher,
	}
}

func (r *chirouter) Handler() http.Handler {
	return r.router
}

func (r *chirouter) Register(ctx context.Context, routes []config.Route) error {
	// Setup logger
	logger := logging.FromContext(ctx)
	logger.Debug("begin route registration", slog.Int("count", len(routes)))

	// Basic middleware registration
	r.router.Use(
		middleware.StripSlashes,
		middleware.RealIP,
		middleware.Recoverer,
		AccessLogMiddleware(logger), // Custom middleware for logging requests and their responses
	)

	// Register all routes
	for _, route := range routes {
		executer, err := r.executerCollection.For(&route)
		if err != nil {
			logger.Error("no executer available for route " + route.String())
			continue
		}
		r.addRoute(route, executer, logger)
	}

	logger.Debug("route registration done")

	return nil
}

// Actual route registration with the handler function definition
func (r *chirouter) addRoute(route config.Route, executor execution.Executer, logger *slog.Logger) {
	routePattern, _ := strings.CutSuffix(route.Route, "/")
	options := []string{}

	// Define handler for this route
	optimizedRoute := OptimizeRoute(route)
	routeHandler := r.handlerFor(&optimizedRoute, executor, logger)

	// Wrap in caching middleware if configured
	if optimizedRoute.Caching && optimizedRoute.Method == http.MethodGet {
		routeHandler = r.cacher.Cache(routeHandler)
		options = append(options, "caching")
	}

	// Register route
	r.router.Method(optimizedRoute.Method, routePattern, routeHandler)

	var optionsText string
	if len(options) > 0 {
		optionsText = fmt.Sprintf("(+%s)", strings.Join(options, ","))
	}

	logger.Debug(fmt.Sprintf("- %s %s %s", route.Method, routePattern, optionsText))
}

func (r *chirouter) handlerFor(route *OptimizedRoute, executor execution.Executer, logger *slog.Logger) http.HandlerFunc {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		ctx := req.Context()

		// Execution config
		execConfig := execution.ConfigFromRoute(&route.Route)
		if route.AllowBody {
			execConfig.Stdin = req.Body
		}

		// Load parameters as env variables
		execConfig.Env = route.parameters.For(req)

		// On handle, start executor for route
		result, exitCode, err := executor.Execute(ctx, execConfig)
		if err != nil {
			// Unexpected error, code 500, no response body
			logger.ErrorContext(ctx,
				"unexpected error while handling route",
				slog.String("error", err.Error()),
				slog.String("route", route.Route.Route),
			)
			w.WriteHeader(http.StatusInternalServerError)

			return
		}

		// Load response config for exit code
		exitResponse := route.ExitCodeResponse(exitCode)

		// Set headers (default and exit code related)
		for header, value := range route.Headers {
			w.Header().Add(header, value)
		}
		for header, value := range exitResponse.Headers {
			w.Header().Add(header, value)
		}
		// Add Server header
		w.Header().Add("Server", ServerHeader)

		// Respond with command result and mapped status code from exit code
		w.WriteHeader(exitResponse.StatusCode)
		if buffer := exitResponse.ResponseBufferFor(result); buffer != nil {
			w.Write(buffer.Bytes())
		}

	})
}
