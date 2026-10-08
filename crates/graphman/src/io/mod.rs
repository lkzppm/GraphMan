//! Reading graphs (and the names of their vertices) from the course's text
//! formats and writing result files.

mod edge_list;
mod names;
mod summary;

pub use edge_list::{EdgeList, ParseError};
pub use names::{NamesError, VertexNames};
pub use summary::write_summary;
