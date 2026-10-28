{
  description = ''
    Psysonic for NixOS / nixpkgs: installable app + dev shell.

    Packages:
      nix build .#psysonic          # or .#default — desktop app; GDK follows session (no wrapper pin)
      nix build .#psysonic-gdk-session   # same derivation (back-compat alias); see nixos-install.md
      nix build .#psysonic-x11-legacy    # legacy: GDK_BACKEND=x11 wrapper (old default)
      nix profile install .#psysonic

    Run (after build, or from any clone with flake):
      nix run .#psysonic
      nix run .#psysonic-gdk-session   # identical to psysonic
      nix run .#psysonic-x11-legacy    # GDK x11 pinned (former default wrap)
      nix run github:Psysonic/psysonic

    Development:
      nix develop                   # mkShell (Rust/Node/WebKit deps); same GDK idea as installable (no GDK pin)
      nix shell .#devShells.default # same environment without entering subshell semantics
      Local cargo output: .build-local/ (gitignored; not copied into flake source tarball)

    Release pipeline updates `flake.lock` (nixpkgs pin refresh) and
    `nix/upstream-sources.json` (npmDepsHash) on every `v*` tag push —
    see `.github/workflows/release.yml` (verify-nix job). Package version
    is read from `package.json`; nothing in this file needs manual bumping
    per release.
  '';

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    rust-overlay = {
      url = "github:oxalica/rust-overlay";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs =
    { self, nixpkgs, rust-overlay }:
    let
      inherit (nixpkgs) lib;
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forSystem = f: lib.genAttrs systems f;

      mkShellFor =
        system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ rust-overlay.overlays.default ];
          };
          # Temporary until nixpkgs' Rust coverage runtime and LLVM agree again.
          # Keep the compiler, profiler runtime and LLVM tools in one upstream release.
          rustToolchain = pkgs.rust-bin.stable.latest.default.override {
            extensions = [ "llvm-tools-preview" ];
          };
          llvmBin = "${rustToolchain}/lib/rustlib/${pkgs.stdenv.hostPlatform.rust.rustcTarget}/bin";
          cargoLlvmCov = (pkgs.cargo-llvm-cov.override {
            rustPlatform = pkgs.makeRustPlatform {
              cargo = rustToolchain;
              rustc = rustToolchain;
            };
          }).overrideAttrs (old: {
            env = (old.env or { }) // {
              LLVM_COV = "${llvmBin}/llvm-cov";
              LLVM_PROFDATA = "${llvmBin}/llvm-profdata";
            };
          });
          gstPlugins = with pkgs.gst_all_1; [
            gstreamer
            gst-plugins-base
            gst-plugins-good
            gst-plugins-bad
          ];
          gstPluginPath = pkgs.lib.makeSearchPath "lib/gstreamer-1.0" gstPlugins;
        in
        pkgs.mkShell {
          packages = with pkgs; [
            nodejs_24
            rustToolchain
            cargoLlvmCov
            jq
            cmake
            pkg-config
            openssl
            gtk3
            webkitgtk_4_1
            libsoup_3
            glib-networking
            atk
            cairo
            gdk-pixbuf
            glib
            pango
            librsvg
            alsa-lib
            libayatana-appindicator
          ]
          ++ gstPlugins;

          shellHook = ''
            _repo="$(git rev-parse --show-toplevel 2>/dev/null || true)"
            if [ -n "$_repo" ] && [ -f "$_repo/flake.nix" ]; then
              export CARGO_TARGET_DIR="''${CARGO_TARGET_DIR:-$_repo/.build-local/cargo-target}"
            fi
            export LD_LIBRARY_PATH="${pkgs.libayatana-appindicator}/lib''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
            export GST_PLUGIN_PATH="${gstPluginPath}''${GST_PLUGIN_PATH:+:$GST_PLUGIN_PATH}"
            export GIO_EXTRA_MODULES="${pkgs.glib-networking}/lib/gio/modules''${GIO_EXTRA_MODULES:+:$GIO_EXTRA_MODULES}"
            export LLVM_COV="${llvmBin}/llvm-cov"
            export LLVM_PROFDATA="${llvmBin}/llvm-profdata"
            unset CI
          '';

          OPENSSL_LIB_DIR = "${pkgs.openssl.out}/lib";
          OPENSSL_INCLUDE_DIR = "${pkgs.openssl.dev}/include";
        };

      upstreamMeta = lib.importJSON ./nix/upstream-sources.json;

      psysonicFor =
        system:
        nixpkgs.legacyPackages.${system}.callPackage ./nix/psysonic.nix {
          src = self;
          inherit upstreamMeta;
        };

      # Same app with GDK_BACKEND pinned to X11 — previous default wrapper behaviour (see nixos-install.md).
      psysonicX11LegacyFor =
        system:
        nixpkgs.legacyPackages.${system}.callPackage ./nix/psysonic.nix {
          src = self;
          inherit upstreamMeta;
          forceGdkX11 = true;
        };

    in
    {
      devShells = forSystem (system: { default = mkShellFor system; });

      packages = forSystem (
        system:
        let
          p = psysonicFor system;
          pX11 = psysonicX11LegacyFor system;
        in
        {
          psysonic = p;
          psysonic-gdk-session = p;
          psysonic-x11-legacy = pX11;
          default = p;
        }
      );

      apps = forSystem (
        system:
        let
          p = psysonicFor system;
          pX11 = psysonicX11LegacyFor system;
        in
        {
          default = {
            type = "app";
            program = lib.getExe p;
            meta = {
              inherit (p.meta) description homepage license;
              mainProgram = "psysonic";
            };
          };
          psysonic-gdk-session = {
            type = "app";
            program = lib.getExe p;
            meta = {
              inherit (p.meta) description homepage license;
              mainProgram = "psysonic";
            };
          };
          psysonic-x11-legacy = {
            type = "app";
            program = lib.getExe pX11;
            meta = {
              inherit (pX11.meta) description homepage license;
              mainProgram = "psysonic";
            };
          };
        }
      );
    };
}
