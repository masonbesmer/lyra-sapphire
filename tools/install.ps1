#!/usr/bin/env pwsh
# Cross-platform install script for Lyra Sapphire (PowerShell)
# Usage: Run this script from the project root

function Check-Command($cmd) {
    $null -ne (Get-Command $cmd -ErrorAction SilentlyContinue)
}

if (-not (Check-Command node)) {
    Write-Host "Node.js not found. Attempting to install Node.js using winget..."
    if ($IsWindows) {
        if (Check-Command winget) {
            winget install -e --id OpenJS.NodeJS.LTS -h
            if (-not (Check-Command node)) {
                Write-Host "Node.js installation failed. Please install Node.js manually from https://nodejs.org/ and rerun this script."
                exit 1
            }
        } else {
            Write-Host "winget not found. Please install Node.js manually from https://nodejs.org/ and rerun this script."
            exit 1
        }
    } else {
        Write-Host "Node.js not found. Please install Node.js (https://nodejs.org/) and rerun this script."
        exit 1
    }
}


# Ensure Yarn 4 is installed using corepack
if (-not (Check-Command yarn)) {
    Write-Host "Yarn not found. Enabling and preparing Yarn 4 with corepack..."
    corepack enable
    corepack prepare yarn@4 --activate
} else {
    $yarnVersion = yarn --version
    if (-not ($yarnVersion.StartsWith('4.'))) {
        Write-Host "Yarn version is $yarnVersion. Upgrading to Yarn 4..."
        corepack prepare yarn@4 --activate
    }
}

Write-Host "Installing project dependencies with Yarn 4..."
yarn install

Write-Host "All dependencies installed."
