package config

import (
	"time"

	"github.com/bdoerfchen/webcmd/src/common/timem"
	"github.com/bdoerfchen/webcmd/src/services/server"
)

type AppConfig struct {
	Server  server.Config // All http server related configurations
	Routes  []Route       // A list of routes to serve
	Modules ModulesConfig // Configuration regarding additional server-wide functionality
}

func DefaultAppConfig() AppConfig {
	return AppConfig{
		Server: server.Config{
			Host: "0.0.0.0",
			Port: 8080,
		},
		Routes: make([]Route, 0),
		Modules: ModulesConfig{
			ShellPool: ShellPoolConfig{
				Path: "/usr/bin/bash",
				Args: []string{"-s"},
				Size: 2,
			},
			Cache: CacheConfig{
				MaxResponsesCached: 100,
				TTL:                timem.Duration(10 * time.Minute),
			},
		},
	}
}
