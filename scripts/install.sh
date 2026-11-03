#!/bin/bash
set -e

# Psysonic Auto-Installer
# Automatically detects your OS and installs the latest release from GitHub

REPO="Psysonic/psysonic"
APP_NAME="psysonic"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Every message goes to stderr: get_download_url hands its result back on
# stdout, and a log line there would end up inside the captured URL.
say() {
    printf '%b[%s]%b %s\n' "$1" "$2" "$NC" "$3" >&2
}

info() { say "$BLUE" INFO "$1"; }
success() { say "$GREEN" SUCCESS "$1"; }
warn() { say "$YELLOW" WARN "$1"; }
error() { say "$RED" ERROR "$1"; exit 1; }

# Save a release asset. A failed request must abort instead of leaving an
# HTML error page behind as the package, and the URL is taken literally.
download() {
    curl --location --fail --globoff --output "$2" "$1"
}

# Check if running as root
check_root() {
    if [ "$EUID" -ne 0 ]; then
        error "Please run this script as root (use sudo)"
    fi
}

# Detect package manager and OS type
detect_os() {
    if command -v apt &> /dev/null; then
        OS_TYPE="debian"
        PACKAGE_MANAGER="apt"
        info "Detected Debian/Ubuntu-based system (apt)"
    elif command -v dnf &> /dev/null; then
        OS_TYPE="rhel"
        PACKAGE_MANAGER="dnf"
        info "Detected RHEL/Fedora-based system (dnf)"
    elif command -v yum &> /dev/null; then
        OS_TYPE="rhel"
        PACKAGE_MANAGER="yum"
        info "Detected RHEL/CentOS-based system (yum)"
    else
        error "Unsupported package manager. This installer supports Debian/Ubuntu and RHEL/Fedora/CentOS systems."
    fi
}

# Get the latest release download URL for the specific package type
get_download_url() {
    local api_url="https://api.github.com/repos/${REPO}/releases/latest"
    
    info "Fetching latest release information..."
    
    local release_info
    release_info=$(curl -s "$api_url")
    
    if echo "$release_info" | grep -q "message.*Not Found"; then
        error "Could not fetch release information. Please check your internet connection."
    fi
    
    local tag_name
    tag_name=$(echo "$release_info" | grep -o '"tag_name": *"[^"]*"' | head -1 | cut -d'"' -f4)
    
    if [ -z "$tag_name" ]; then
        error "Could not determine latest release version."
    fi
    
    info "Latest version: $tag_name"
    
    local download_url=""
    
    if [ "$OS_TYPE" = "debian" ]; then
        download_url=$(echo "$release_info" | grep -o '"browser_download_url": *"[^"]*\.deb"' | head -1 | cut -d'"' -f4)
    elif [ "$OS_TYPE" = "rhel" ]; then
        download_url=$(echo "$release_info" | grep -o '"browser_download_url": *"[^"]*\.rpm"' | head -1 | cut -d'"' -f4)
    fi
    
    if [ -z "$download_url" ]; then
        error "Could not find download URL for $OS_TYPE package."
    fi
    
    echo "$download_url"
}

# Install the package
install_package() {
    local download_url="$1"
    local temp_dir
    temp_dir=$(mktemp -d)
    local package_file="$temp_dir/${APP_NAME}_latest"
    
    info "Downloading package..."
    
    if [ "$OS_TYPE" = "debian" ]; then
        package_file="${package_file}.deb"
        download "$download_url" "$package_file"
        
        info "Installing package..."
        $PACKAGE_MANAGER install -y "$package_file" || {
            warn "Trying to fix broken dependencies..."
            $PACKAGE_MANAGER install -f -y
        }
    elif [ "$OS_TYPE" = "rhel" ]; then
        package_file="${package_file}.rpm"
        download "$download_url" "$package_file"
        
        info "Installing package..."
        $PACKAGE_MANAGER install -y "$package_file"
    fi
    
    # Cleanup
    rm -rf "$temp_dir"
}

# Check if app is already installed
check_installed() {
    if command -v $APP_NAME &> /dev/null || command -v ${APP_NAME^} &> /dev/null; then
        warn "${APP_NAME} appears to be already installed."
        # When the script arrives through `curl | bash`, stdin is the script
        # itself, so the question has to go to the terminal. Whether one is
        # attached only shows when /dev/tty is actually opened.
        if ! (exec </dev/tty) 2>/dev/null; then
            warn "No terminal to ask on; keeping the existing installation."
            exit 0
        fi
        read -r -n 1 -p "Do you want to reinstall? (y/N): " REPLY </dev/tty
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            info "Installation cancelled."
            exit 0
        fi
    fi
}

# Main installation flow
main() {
    echo -e "${GREEN}"
    echo "╔══════════════════════════════════════════════════════════╗"
    echo "║           Psysonic Auto-Installer                        ║"
    echo "║   Install the latest release from GitHub Releases        ║"
    echo "╚══════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    check_root
    detect_os
    check_installed
    
    local download_url
    download_url=$(get_download_url)
    
    if [ -z "$download_url" ]; then
        error "Failed to get download URL."
    fi
    
    info "Download URL: $download_url"
    
    install_package "$download_url"
    
    echo ""
    success "Psysonic has been installed successfully!"
    echo -e "${BLUE}You can launch it from your application menu or by running:${NC} psysonic"
    echo ""
}

# Run main function
main
