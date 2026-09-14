# Symphonia ISO/MP4 Demuxer

[<img alt="Docs.rs" src="https://img.shields.io/badge/docs.rs-symphonia_format_isomp4-brightgreen?style=for-the-badge" height="22"/>](https://docs.rs/symphonia-format-isomp4)

ISO/MP4 demuxer for Project Symphonia.

> [!NOTE]
> This crate is part of Project Symphonia. Please use the [`symphonia`](https://crates.io/crates/symphonia) crate instead of this one directly.

## Psysonic patch provenance

This directory vendors the published `symphonia-format-isomp4 0.6.1` crate from
Symphonia commit `ee35874b571a35a9a6e15d3bc9a3aaf8f11fbeee` (crates.io checksum
`0e681a70e1870d34e02abf1dbc51e4267c3f1827801474e8870be8c689fc4dc3`). Psysonic
preserves the current `mdat` atom as the iterator's resynchronization boundary when
EOF is reached, fixing seek-after-EOF without relaxing raw reads as proposed by
upstream PR [#536](https://github.com/pdeljanov/Symphonia/pull/536).

Before replacing or removing this patch, run Psysonic's ordinary, fragmented,
padded-`mdat`, repeated-EOF, ranged-source, and analysis-window M4A regression tests.

## License

Symphonia is provided under the MPL v2.0 license. Please refer to the LICENSE file for more details.

## Contributing

Symphonia is a free and open-source project that welcomes contributions! To get started, please read our [Contribution Guidelines](https://github.com/pdeljanov/Symphonia/blob/main/CONTRIBUTING.md).
