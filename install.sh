#!/usr/bin/env bash
# Cross-platform install script for Lyra Sapphire
# Usage: Run this script from the project root

set -e

# Detect OS
if [ "$(uname)" = "Darwin" ]; then
  OS="macos"
elif [ "$(uname -s)" = "Linux" ]; then
  OS="linux"
else
  echo "Unsupported OS. Please install dependencies manually."
  exit 1
fi

# ── macOS: ensure Homebrew is available ────────────────────────────────────────
if [ "$OS" = "macos" ]; then
  if ! command -v brew >/dev/null 2>&1; then
    echo "Homebrew not found. Installing Homebrew (official installer from brew.sh)..."
    # This uses the official Homebrew install script: https://brew.sh
    /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
    # Add brew to PATH for Apple Silicon Macs
    if [ -f /opt/homebrew/bin/brew ]; then
      eval "$(/opt/homebrew/bin/brew shellenv)"
    fi
  fi
fi

# ── Install Node.js if missing ─────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Installing Node.js..."
  if [ "$OS" = "macos" ]; then
    brew install node
  elif [ "$OS" = "linux" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash -
      sudo apt-get install -y nodejs
    else
      echo "Node.js not found. Please install Node.js (https://nodejs.org/) and rerun this script."
      exit 1
    fi
  fi
fi

echo "Node.js $(node --version) detected."

# ── Install ffmpeg if missing (required for audio processing) ──────────────────
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not found. Installing ffmpeg..."
  if [ "$OS" = "macos" ]; then
    brew install ffmpeg
  elif [ "$OS" = "linux" ]; then
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get install -y ffmpeg
    else
      echo "ffmpeg not found. Please install ffmpeg manually and rerun this script."
      exit 1
    fi
  fi
fi

echo "ffmpeg $(ffmpeg -version 2>&1 | head -1) detected."

# ── Install / upgrade to Yarn 4 via Corepack ───────────────────────────────────
if ! command -v corepack >/dev/null 2>&1; then
  echo "corepack not found. Installing via npm..."
  npm install -g corepack --force
fi

echo "Enabling Corepack and preparing Yarn 4..."
corepack enable

if ! command -v yarn >/dev/null 2>&1; then
  corepack prepare yarn@stable --activate
else
  YARN_VERSION=$(yarn --version 2>/dev/null || echo "unknown")
  case "$YARN_VERSION" in
    4.*) echo "Yarn $YARN_VERSION already installed." ;;
    unknown)
      echo "Could not determine Yarn version. Installing Yarn 4 via Corepack..."
      corepack prepare yarn@stable --activate
      ;;
    *)
      echo "Yarn $YARN_VERSION found. Upgrading to Yarn 4..."
      corepack prepare yarn@stable --activate 
      ;;
  esac
fi

echo "Yarn $(yarn --version) ready."

# ── Install project dependencies ──────────────────────────────────────────────
echo "Installing project dependencies with Yarn..."
yarn install

echo "All dependencies installed successfully."
