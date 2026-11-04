//! Reading graphs (and the names of their vertices) from the course's text
//! formats and writing result files.

pub(crate) mod collaboration;
mod edge_list;
mod names;
mod summary;

pub use collaboration::{Edges, Network, Papers, YEAR_UNKNOWN};
pub use edge_list::{EdgeList, ParseError};
pub use names::{NamesError, VertexNames};
pub use summary::write_summary;
