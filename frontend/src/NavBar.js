import React from 'react';
import { Navbar, Nav, Container, Link } from 'react-bootstrap';

const AppNavbar = () => {
  return (
    <Navbar bg="dark" variant="dark" expand="lg" sticky="top">
      <Container>
        <Navbar.Brand href="/">MyApp</Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            <Nav.Link href="/">Home</Nav.Link>
            <Nav.Link href="/callback">Currently Playing</Nav.Link>
            <Nav.Link href="/recently_played">Recently Played</Nav.Link>
            <Nav.Link href="/top_artists">Top Artists</Nav.Link>
            <Nav.Link href="/top_songs">Top Songs</Nav.Link>
            <Nav.Link href="/upload_history">Upload History</Nav.Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default AppNavbar;
