import React, { useState } from "react";
import { set } from "react-hook-form";
import Payment from "./genres"
import Summary from "./topAlbums";


function App() {

    const [dataF, setDataF] = useState({});
    const [viewer, setViewer] = useState(0);


    return (<div>
        { viewer == 0 ? <Payment dataF={dataF} setDataF={setDataF} viewer={viewer} setViewer={setViewer} /> : <></>}
        { viewer == 1 ? <Summary dataF={dataF} setDataF={setDataF} viewer={viewer} setViewer={setViewer} /> : <></>}
    </div>
    );
}
export default App;
