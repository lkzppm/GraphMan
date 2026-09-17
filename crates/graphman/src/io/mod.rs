//! Reading graphs from the course's text format and writing result files.

mod edge_list;
mod summary;

pub use edge_list::{EdgeList, ParseError};
pub use summary::write_summary;
