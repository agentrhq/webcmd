package springercacher

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/bdoerfchen/webcmd/src/common/config"
	cache "github.com/victorspringer/http-cache"
	"github.com/victorspringer/http-cache/adapter/memory"
)

// A Cacher implementation that uses the memory cache of Victor Springer internally
type springerCacher struct {
	client             *cache.Client
	headerCacheControl string
}

func New(config *config.CacheConfig) (*springerCacher, error) {
	// Create memory adapter
	memAdapter, err := memory.NewAdapter(
		memory.AdapterWithCapacity(int(config.MaxResponsesCached)),
		memory.AdapterWithAlgorithm(memory.LRU), // Least recentlly used response is removed when capacity is reached
	)
	if err != nil {
		return nil, fmt.Errorf("error while creating memory adapter: %w", err)
	}

	// Create client
	cacheClient, err := cache.NewClient(
		cache.ClientWithAdapter(memAdapter),
		cache.ClientWithTTL(time.Duration(config.TTL)),
	)
	if err != nil {
		return nil, fmt.Errorf("error while creating cache client: %w", err)
	}

	// Cache-Control
	cacheDirectives := append(
		[]string{"max-age=" + strconv.Itoa(int(time.Duration(config.TTL).Seconds()))},
		config.ControlDirectives...,
	)

	// Return
	return &springerCacher{
		client:             cacheClient,
		headerCacheControl: strings.Join(cacheDirectives, ", "),
	}, nil
}

func (c *springerCacher) Cache(handler http.HandlerFunc) http.HandlerFunc {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Set date explicitly so its not set again by http server. TZ needs to be GMT (RFC1123)
		w.Header().Add("Date", time.Now().UTC().Format("Mon, 02 Jan 2006 15:04:05")+" GMT")
		// Set cache-control header
		w.Header().Add("Cache-Control", c.headerCacheControl)
		// Return cache response
		c.client.Middleware(handler).ServeHTTP(w, r)
	})
}
