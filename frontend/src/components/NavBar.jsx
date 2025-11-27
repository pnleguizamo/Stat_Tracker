import React from 'react';
import { Navbar, Nav, Container } from 'react-bootstrap';
import { Link, useLocation } from "react-router-dom";
import "../styles/NavBar.css";

const AppNavbar = () => {
  const currentPage = useLocation().pathname;

  return (
    <Navbar bg="dark" variant="dark" expand="lg" sticky="top">
      <Container fluid>
        <Navbar.Brand>Stat Tracker</Navbar.Brand>
        <Navbar.Toggle aria-controls="basic-navbar-nav" />
        <Navbar.Collapse id="basic-navbar-nav" >
          <Nav className="me-auto">
            <Link
              key="1"
              className={currentPage === '/dashboard' ? 'nav-link active' : 'nav-link'}
              to="/dashboard"
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
              className={currentPage === '/top_albums' ? 'nav-link active' : 'nav-link'}
              to="/top_albums"
            >
              Top Albums
            </Link>
            <Link
              key="6"
              className={currentPage === '/upload_history' ? 'nav-link active' : 'nav-link'}
              to="/upload_history"
            >
              Upload History
            </Link>
            <Link
              key="7"
              className={currentPage === '/lobby' ? 'nav-link active' : 'nav-link'}
              to="/lobby"
            >
              Game Lobby
            </Link>
          </Nav>
        </Navbar.Collapse>
      </Container>
    </Navbar>
  );
};

export default AppNavbar;
