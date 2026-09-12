package cmd

import (
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"runtime"
	"strings"

	"github.com/bdoerfchen/webcmd/src/common/config"
)

const defaultRouteCommand = "echo Your webcmd works! Visit https://github.com/bdoerfchen/webcmd to learn more about how to use it."

func mergeCommandFlags(base *config.AppConfig, logger *slog.Logger) {
	// --- Merge server config
	if flagServerHost != "" {
		logger.Debug(fmt.Sprintf("flag: host=%s", flagServerHost))
		base.Server.Host = flagServerHost
	}
	if flagServerPort != 0 {
		logger.Debug(fmt.Sprintf("flag: port=%v", flagServerPort))
		base.Server.Port = flagServerPort
	}

	// --- Add route
	route := config.DefaultRoute()
	// Define default response code 500
	route.StatusCodes = append(route.StatusCodes, config.ExitCodeMapping{
		StatusCode:     http.StatusInternalServerError,
		ResponseStream: config.None,
	})
	routeTouched := false

	// Set method and route
	if flagRouteMethod != "" {
		route.Method = flagRoutePattern
		routeTouched = true
	}
	if flagRoutePattern != "" {
		route.Route = flagRoutePattern
		routeTouched = true
	}

	// Set default process
	var procConfig config.ExecProc
	if runtime.GOOS == "windows" {
		procConfig.Path = "cmd"
		procConfig.Args = []string{"/C", defaultRouteCommand}
	} else {
		procConfig.Path = "bash"
		procConfig.Args = []string{"-c", defaultRouteCommand}
	}
	route.Exec.Proc = &procConfig

	// Overwrite shellarg when provided with --
	parts := strings.SplitAfterN(strings.Join(os.Args, " "), " -- ", 2)
	if len(parts) > 1 {
		procConfig.Args[1] = parts[1]
		routeTouched = true
	}

	// Add route if there is no route defined yet, or it was explicitly configured with flags
	if len(base.Routes) == 0 || routeTouched {
		logger.Debug("adding route provided by command line: " + route.String())
		base.Routes = append(base.Routes, route)
	}
}

func checkConfig(appConfig *config.AppConfig, logger *slog.Logger) error {
	logger.Debug("checking configuration")

	var countWarning, countCritical int
	// Check all routes
	for _, route := range appConfig.Routes {
		messages := route.Check()
		if len(messages) == 0 {
			continue
		}

		// Log remarks with their respective logging function and increase counters
		logger.Info(fmt.Sprintf("%s with remarks:", route.String()))
		for _, e := range messages {
			level := "info: "
			switch e.Level {
			case config.ErrorLevelWarning:
				level = "warn: "
				countWarning++
			case config.ErrorLevelCritical:
				level = "crit: "
				countCritical++
			}

			logger.Info("- " + level + e.Message)
		}
	}

	logger.Debug("configuration check done")

	if countWarning+countCritical == 0 {
		logger.Info("config ok")
	} else {
		logger.Warn("config with problems")
	}

	if countCritical > 0 {
		return fmt.Errorf("encountered %v critical remarks", countCritical)
	}
	return nil
}
