import React from 'react';
import { Navbar, Nav, Container } from 'react-bootstrap';
import { Link, useLocation } from "react-router-dom";
import "./NavBar.css";

const AppNavbar = () => {
  const currentPage = useLocation().pathname;

  return (
    <Navbar bg="dark" variant="dark" expand="lg" sticky="top">
      <Container>
        <Navbar.Brand>Stat Tracker</Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav">
          <Nav className="me-auto">
            <Link
              key="1"
              className={currentPage === '/callback' ? 'nav-link active' : 'nav-link'}
              to="/callback"
            >
              Dashboard
            </Link>
            <Link
              key="2"
              className={currentPage === '/recently_played' ? 'nav-link active' : 'nav-link'}
              to="/recently_played"
            >
              Recently Played
            </Link>
            <Link
              key="3"
              className={currentPage === '/top_artists' ? 'nav-link active' : 'nav-link'}
              to="/top_artists"
            >
              Top Artists
            </Link>
            <Link
              key="4"
              className={currentPage === '/top_songs' ? 'nav-link active' : 'nav-link'}
              to="/top_songs"
            >
              Top Songs
            </Link>
            <Link
              key="5"
              className={currentPage === '/upload_history' ? 'nav-link active' : 'nav-link'}
              to="/upload_history"
            >
              Upload History
            </Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default AppNavbar;
