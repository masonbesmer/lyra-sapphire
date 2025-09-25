# Cross-platform install script for Lyra Sapphire
# Usage: Run this script from the project root

# Detect OS
if [ "$(uname)" = "Darwin" ]; then
  OS="macos"
elif [ "$(expr substr $(uname -s) 1 5)" = "Linux" ]; then
  OS="linux"
else
  OS="windows"
fi

# Install Node.js (if not installed)
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js not found. Please install Node.js (https://nodejs.org/) and rerun this script."
  exit 1
fi

# Install Yarn (if not installed)
if ! command -v yarn >/dev/null 2>&1; then
  echo "Yarn not found. Installing Yarn..."
  npm install -g yarn
fi

echo "Installing project dependencies with Yarn..."
yarn install

echo "All dependencies installed."
