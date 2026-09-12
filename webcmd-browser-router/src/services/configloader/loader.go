package configloader

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/bdoerfchen/webcmd/src/common/config"
	"github.com/bdoerfchen/webcmd/src/logging"
	"github.com/jinzhu/copier"
	"sigs.k8s.io/yaml"
)

const DefaultConfigFile = "server.config.yaml"

type configLoader struct{}

func New() *configLoader {
	return &configLoader{}
}

func (l *configLoader) Load(ctx context.Context, path string) (*config.AppConfig, error) {
	var useDefaultPath bool
	logger := logging.FromContext(ctx)
	result := config.DefaultAppConfig()

	// Handle no path defined
	if path == "" {
		logger.Info("no config file path provided. Try default file path: " + DefaultConfigFile)
		path = DefaultConfigFile
		useDefaultPath = true
	}

	file, err := os.Stat(path)
	if err != nil {
		if useDefaultPath {
			logger.Warn("default file does not exist. Using default route configuration.")
			return &result, nil
		}

		return nil, fmt.Errorf("unable to open file: %w", err)
	}
	// Append default file name if provided path is a directory
	if file.IsDir() {
		path = filepath.Join(path, DefaultConfigFile)
	}

	// Read file
	content, err := os.ReadFile(path)
	if err != nil {
		if strings.Contains(err.Error(), "not exist") || !useDefaultPath {
			return nil, err
		}

		// Return default if no specific config file should be loaded
		return &result, nil
	}
	logger.Debug(fmt.Sprintf("using config file %s", path))

	var parsedConfig config.AppConfig
	err = yaml.Unmarshal(content, &parsedConfig)
	if err != nil {
		return nil, fmt.Errorf("error while parsing config file: %w", err)
	}

	// Use default config as base and overlay parsed server config onto it
	copier.CopyWithOption(&result.Server, &parsedConfig.Server, copier.Option{IgnoreEmpty: true})
	copier.CopyWithOption(&result.Modules, &parsedConfig.Modules, copier.Option{IgnoreEmpty: true, DeepCopy: true})
	for _, configRoute := range parsedConfig.Routes {
		// Go over parsed config's routes and append their content overlayed on the default to the result config
		copiedRoute := config.DefaultRoute()
		copier.CopyWithOption(&copiedRoute, &configRoute, copier.Option{IgnoreEmpty: true})
		copiedRoute.StatusCodes = append(config.DefaultRoute().StatusCodes, configRoute.StatusCodes...)
		result.Routes = append(result.Routes, copiedRoute)
	}

	return &result, nil
}
