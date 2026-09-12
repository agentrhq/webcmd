package config

import (
	"github.com/bdoerfchen/webcmd/src/common/timem"
)

type ModulesConfig struct {
	ShellPool ShellPoolConfig
	Cache     CacheConfig
}

type ShellPoolConfig struct {
	Path string   // Shell binary path
	Args []string // Process arguments
	Size uint     // The maximum amount of shell processes to prepare
}

type CacheConfig struct {
	MaxResponsesCached uint           // Limit of request responses to cache
	TTL                timem.Duration // Time to live for a cache entry
	ControlDirectives  []string       // List of additional cache-control directives to include
}
