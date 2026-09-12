package router

import (
	"context"
	"net/http"

	"github.com/bdoerfchen/webcmd/src/common/config"
)

type Router interface {
	Register(ctx context.Context, routes []config.Route) error
	Handler() http.Handler
}
