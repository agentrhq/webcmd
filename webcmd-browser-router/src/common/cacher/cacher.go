package cacher

import "net/http"

type Cacher interface {
	// Returns a wrapping handler that caches the given HandlerFunc
	Cache(handler http.HandlerFunc) http.HandlerFunc
}
