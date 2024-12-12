import React from 'react';
import './About.css';

const AboutCard = ({ name, email, prof }) => {
  return (
    <div className="grid-item">
      <h3>About {prof && <>Professor</>}</h3>
      <p><strong>Name:</strong> {name}</p>
      <p><strong>Class:</strong> SE/ComS 319</p>
      <p><strong>Email:</strong> <a href={`mailto:${email}`}>{email}</a></p>
      <p><strong>Date:</strong> 12/11/24</p>
    </div>
  );
};

const AboutSection = () => {
  return (
    <div className="App">
      <h1>About Us</h1>
      <div className="grid-container">
        <AboutCard name="Gavin Nienke" email="gn13@iastate.edu" />
        <AboutCard name="Pablo Leguizamo" email="pnleg@iastate.edu" />
      </div>
      <div className="grid-container">
        <AboutCard name="Dr. Abraham N. Aldaco Gastelum" email="aaldaco@iastate.edu" prof="1" />
      </div>
      
    </div>
  );
};

export default AboutSection;
