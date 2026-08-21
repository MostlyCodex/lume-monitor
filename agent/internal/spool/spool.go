package spool

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
)

const maxReportBytes = 64 * 1024

func Load(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if info.Size() > maxReportBytes {
		return nil, fmt.Errorf("pending report exceeds %d bytes", maxReportBytes)
	}
	return os.ReadFile(path)
}

func Save(path string, body []byte) error {
	if len(body) > maxReportBytes {
		return fmt.Errorf("report exceeds %d bytes", maxReportBytes)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, body, 0o600); err != nil {
		return err
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return nil
}

func Delete(path string) error {
	err := os.Remove(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
