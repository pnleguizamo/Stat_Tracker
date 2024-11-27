
import "bootstrap/dist/css/bootstrap.css";

function Summary({dataF, setDataF, setViewer}) {
    const updateHooks = () => {
        setViewer(0);
        // setDataF(0);
    };

    return (<div>
        <h1>Payment summary:</h1>
        <h3>{dataF.fullName}</h3>
        <p>{dataF.email}</p>
        <p>{dataF.creditCard}</p>
        <p>{dataF.address}</p>
        <p>{dataF.city},{dataF.state} {dataF.zip} </p>

        <button onClick={updateHooks} className="btn btn-secondary">Submit</button>

    </div>);
};

export default Summary;